package pool

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/MoeForge/moego/ojson"
)

// GitHub resolves the public GitHub profile behind an Access login without a GitHub App.
// Access returns the numeric GitHub user ID; the public users API maps it to a login.
type GitHub struct {
	// IdentityURL is the Access get-identity endpoint. Development uses DevID instead.
	IdentityURL string
	APIBase     string
	DevID       int64
	Client      *http.Client
}

type Profile struct {
	ID     int64
	Login  string
	Name   string
	Avatar string
}

var githubLogin = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)

func NewGitHub(identityURL string, devID int64) *GitHub {
	return &GitHub{IdentityURL: identityURL, APIBase: "https://api.github.com", DevID: devID, Client: &http.Client{Timeout: 10 * time.Second}}
}

// Profile looks up the GitHub account for a verified Access assertion.
func (g *GitHub) Profile(ctx context.Context, assertion string) (Profile, error) {
	id := g.DevID
	if g.IdentityURL != "" {
		var err error
		if id, err = g.accessGitHubID(ctx, assertion); err != nil {
			return Profile{}, err
		}
	}
	if id <= 0 {
		return Profile{}, errors.New("no GitHub account on this identity")
	}
	user, err := g.get(ctx, g.APIBase+"/user/"+strconv.FormatInt(id, 10), nil)
	if err != nil {
		return Profile{}, err
	}
	p := Profile{ID: id, Login: ojson.GetBytes(user, "login").String(), Name: ojson.GetBytes(user, "name").String(), Avatar: ojson.GetBytes(user, "avatar_url").String()}
	if !githubLogin.MatchString(p.Login) {
		return Profile{}, errors.New("invalid GitHub login")
	}
	if !strings.HasPrefix(p.Avatar, "https://avatars.githubusercontent.com/") {
		p.Avatar = ""
	}
	if len(p.Name) > 100 {
		p.Name = p.Name[:100]
	}
	return p, nil
}

func (g *GitHub) accessGitHubID(ctx context.Context, assertion string) (int64, error) {
	identity, err := g.get(ctx, g.IdentityURL, &http.Cookie{Name: "CF_Authorization", Value: assertion})
	if err != nil {
		return 0, err
	}
	if ojson.GetBytes(identity, "idp.type").String() != "github" {
		return 0, errors.New("Access identity is not from GitHub")
	}
	return strconv.ParseInt(ojson.GetBytes(identity, "id").String(), 10, 64)
}

func (g *GitHub) get(ctx context.Context, url string, cookie *http.Cookie) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "pool")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	response, err := g.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("profile lookup: HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err == nil && !ojson.ValidBytes(body) {
		err = errors.New("profile lookup: invalid JSON")
	}
	return body, err
}
