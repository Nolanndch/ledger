//go:build !windows

// Permet de compiler et tester le lanceur sur Mac ou Linux pendant le développement.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {}

func isRefused(err error) bool { return errors.Is(err, syscall.ECONNREFUSED) }

func appBrowsers() []string {
	if runtime.GOOS == "darwin" {
		return []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}
	}
	return []string{"/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"}
}

func openDefault(url string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}

func showError(title, msg string) { fmt.Fprintf(os.Stderr, "%s : %s\n", title, msg) }
