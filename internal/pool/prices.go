package pool

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/MoeForge/moego/ojson"
	log "github.com/sirupsen/logrus"
)

const modelsDevURL = "https://models.dev/api.json"

// Pool providers map to models.dev providers whose public API rates they mirror.
var priceSources = map[string]string{"claude": "anthropic", "codex": "openai"}

// SyncPrices saves new models.dev rates in USD per million tokens, then prices
// earlier complete events that had no rate. Changed rates add a row; history keeps its rate.
func (s *Store) SyncPrices(ctx context.Context, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsDevURL, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("models.dev: HTTP %d", response.StatusCode)
	}
	catalog, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return err
	}
	if !ojson.ValidBytes(catalog) {
		return fmt.Errorf("models.dev: invalid JSON")
	}
	added := 0
	for provider, source := range priceSources {
		ojson.GetBytes(catalog, source+".models").ForEach(func(key, m ojson.Result) bool {
			model, cost := key.String(), m.Get("cost")
			if !cost.Exists() || len(model) > 200 {
				return true
			}
			rates := []float64{cost.Get("input").Float(), cost.Get("output").Float(), cost.Get("cache_read").Float(), cost.Get("cache_write").Float()}
			for _, v := range rates {
				if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1e6 {
					return true
				}
			}
			var result sql.Result
			result, err = s.db.ExecContext(ctx, `INSERT INTO prices(provider,model,input,output,cache_read,cache_write)
SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM prices WHERE id=(SELECT MAX(id) FROM prices WHERE provider=? AND model=?)
 AND input=? AND output=? AND cache_read=? AND cache_write=?)`, provider, model, rates[0], rates[1], rates[2], rates[3], provider, model, rates[0], rates[1], rates[2], rates[3])
			if err != nil {
				return false
			}
			if n, _ := result.RowsAffected(); n > 0 {
				added++
			}
			return true
		})
		if err != nil {
			return err
		}
	}
	// Same formula as RecordUsage: tokens times USD per million tokens is micro-USD.
	result, err := s.db.ExecContext(ctx, `UPDATE events SET
 price_id=(SELECT MAX(id) FROM prices p WHERE p.provider=events.provider AND p.model=events.model),
 cost_micros=(SELECT CAST(ROUND(
   COALESCE(json_extract(events.breakdown,'$.input.uncached_tokens'),0)*p.input+
   COALESCE(json_extract(events.breakdown,'$.input.cache_read_tokens'),0)*p.cache_read+
   COALESCE(json_extract(events.breakdown,'$.input.cache_write_tokens'),0)*p.cache_write+
   events.output*p.output) AS INTEGER)
  FROM prices p WHERE p.id=(SELECT MAX(id) FROM prices q WHERE q.provider=events.provider AND q.model=events.model))
WHERE price_id IS NULL AND json_extract(breakdown,'$.quality')='complete'
 AND EXISTS (SELECT 1 FROM prices p WHERE p.provider=events.provider AND p.model=events.model)`)
	if err != nil {
		return err
	}
	priced, _ := result.RowsAffected()
	log.WithFields(log.Fields{"new_rates": added, "priced_events": priced}).Info("pool: synced models.dev prices")
	return nil
}

// RunPriceSync refreshes prices now and then daily until ctx ends.
func (s *Store) RunPriceSync(ctx context.Context) {
	client := &http.Client{Timeout: time.Minute}
	for {
		if err := s.SyncPrices(ctx, client); err != nil && ctx.Err() == nil {
			log.WithError(err).Warn("pool: models.dev price sync failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}
