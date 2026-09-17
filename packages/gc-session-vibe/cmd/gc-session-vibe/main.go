package main

import (
	"os"

	vibeexec "github.com/mickmister/vibe-kanban-vscode-web/packages/gc-session-vibe/bridge"
)

func main() {
	os.Exit(vibeexec.Run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
