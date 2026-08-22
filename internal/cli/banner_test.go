package cli

import (
	"strings"
	"testing"
)

func TestBannerIncludesVersionAndArt(t *testing.T) {
	t.Run("with explicit version", func(t *testing.T) {
		plain := banner("v1.2.3", false)
		if !strings.Contains(plain, "v1.2.3") {
			t.Errorf("plain banner should contain version v1.2.3, got:\n%s", plain)
		}
		if !strings.Contains(plain, "Local-First IBIS Dialog Mapping") {
			t.Errorf("plain banner missing subtitle, got:\n%s", plain)
		}
		if strings.Contains(plain, "\033[") {
			t.Errorf("plain banner should not contain ANSI escape codes")
		}

		colored := banner("v1.2.3", true)
		if !strings.Contains(colored, "v1.2.3") {
			t.Errorf("colored banner should contain version v1.2.3, got:\n%s", colored)
		}
		if !strings.Contains(colored, "\033[") {
			t.Errorf("colored banner should contain ANSI escape codes")
		}
	})

	t.Run("with empty version falls back to dev", func(t *testing.T) {
		plain := banner("", false)
		if !strings.Contains(plain, "dev") {
			t.Errorf("empty version should fallback to dev, got:\n%s", plain)
		}
	})
}
