package auth

import "time"

// SessionBinding is one live session-to-credential binding, in a form a
// successor process can restore after a graceful upgrade.
type SessionBinding struct {
	Aliases   []string  `json:"aliases"`
	AuthID    string    `json:"auth_id"`
	ExpiresAt time.Time `json:"expires_at"`
	SessionID string    `json:"session_id,omitempty"`
	Provider  string    `json:"provider,omitempty"`
}

// Export returns every unexpired binding group.
func (c *SessionCache) Export() []SessionBinding {
	if c == nil {
		return nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	now := time.Now()
	out := make([]SessionBinding, 0, len(c.groups))
	for _, entry := range c.groups {
		if !now.Before(entry.expiresAt) || entry.authID == "" || len(entry.aliases) == 0 {
			continue
		}
		out = append(out, SessionBinding{
			Aliases:   append([]string(nil), entry.aliases...),
			AuthID:    entry.authID,
			ExpiresAt: entry.expiresAt,
			SessionID: entry.binding.sessionID,
			Provider:  entry.binding.provider,
		})
	}
	return out
}

// Import restores exported bindings with their original expiry. Bindings that
// expired, or whose aliases are already bound here, are skipped.
func (c *SessionCache) Import(bindings []SessionBinding) int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ensureInitializedLocked()
	now := time.Now()
	restored := 0
	for _, b := range bindings {
		aliases := compactSessionAliases(mergeSessionAliases(nil, b.Aliases...))
		if b.AuthID == "" || len(aliases) == 0 || !now.Before(b.ExpiresAt) {
			continue
		}
		taken := false
		for _, alias := range aliases {
			if _, ok := c.entries[alias]; ok {
				taken = true
				break
			}
		}
		if taken {
			continue
		}
		binding := sessionBinding{sessionID: b.SessionID, provider: b.Provider}
		if binding.sessionID != "" && binding.provider != "" {
			c.bindingSequence++
			binding.sequence = c.bindingSequence
		}
		c.replaceAliasGroupsLocked(b.AuthID, b.ExpiresAt, aliases, binding)
		restored++
	}
	return restored
}

// ExportSessionBindings returns the session-affinity bindings of the active selector.
func (m *Manager) ExportSessionBindings() []SessionBinding {
	if s, ok := m.Selector().(*SessionAffinitySelector); ok && s != nil {
		return s.cache.Export()
	}
	return nil
}

// ImportSessionBindings restores bindings into the active session-affinity selector.
func (m *Manager) ImportSessionBindings(bindings []SessionBinding) int {
	if s, ok := m.Selector().(*SessionAffinitySelector); ok && s != nil {
		return s.cache.Import(bindings)
	}
	return 0
}
