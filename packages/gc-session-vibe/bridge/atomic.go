package vibeexec

import (
	"fmt"
	"os"
	"path/filepath"
)

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := f.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := f.Chmod(mode); err != nil {
		_ = f.Close()
		return err
	}
	if len(data) > 0 {
		if _, err := f.Write(data); err != nil {
			_ = f.Close()
			return err
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("rename temp file to %q: %w", path, err)
	}
	return nil
}
