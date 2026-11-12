package pool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
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
	var user struct {
		Login     string `json:"login"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := g.get(ctx, g.APIBase+"/user/"+strconv.FormatInt(id, 10), nil, &user); err != nil {
		return Profile{}, err
	}
	if !githubLogin.MatchString(user.Login) {
		return Profile{}, errors.New("invalid GitHub login")
	}
	if !strings.HasPrefix(user.AvatarURL, "https://avatars.githubusercontent.com/") {
		user.AvatarURL = ""
	}
	if len(user.Name) > 100 {
		user.Name = user.Name[:100]
	}
	return Profile{ID: id, Login: user.Login, Name: user.Name, Avatar: user.AvatarURL}, nil
}

func (g *GitHub) accessGitHubID(ctx context.Context, assertion string) (int64, error) {
	var identity struct {
		ID  json.RawMessage `json:"id"`
		IdP struct {
			Type string `json:"type"`
		} `json:"idp"`
	}
	if err := g.get(ctx, g.IdentityURL, &http.Cookie{Name: "CF_Authorization", Value: assertion}, &identity); err != nil {
		return 0, err
	}
	if identity.IdP.Type != "github" {
		return 0, errors.New("Access identity is not from GitHub")
	}
	return strconv.ParseInt(strings.Trim(string(identity.ID), `"`), 10, 64)
}

func (g *GitHub) get(ctx context.Context, url string, cookie *http.Cookie, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "pool")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	response, err := g.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("profile lookup: HTTP %d", response.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(out)
}
