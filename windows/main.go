// Lanceur Ledger pour Windows : démarre le serveur local embarqué (runtime\node.exe + app\server.mjs)
// puis ouvre l'interface dans une fenêtre d'application Edge (sans onglets ni barre d'adresse).
// Le serveur s'arrête tout seul quelques minutes après la fermeture de la dernière fenêtre.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const idleSeconds = "300"

type probe int

const (
	probeLedger probe = iota
	probeFree
	probeBusy
)

var client = &http.Client{Timeout: 800 * time.Millisecond}

func check(port int) probe {
	res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/info", port))
	if err != nil {
		if isRefused(err) {
			return probeFree
		}
		return probeBusy
	}
	defer res.Body.Close()
	var info struct{ App string }
	if json.NewDecoder(res.Body).Decode(&info) == nil && info.App == "ledger" {
		return probeLedger
	}
	return probeBusy
}

func dataDir() string {
	if runtime.GOOS == "windows" {
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "Ledger")
		}
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "Ledger")
	}
	return filepath.Join(home, ".local", "share", "ledger")
}

func nodePath(base string) string {
	name := "node"
	if runtime.GOOS == "windows" {
		name = "node.exe"
	}
	bundled := filepath.Join(base, "runtime", name)
	if _, err := os.Stat(bundled); err == nil {
		return bundled
	}
	if p, err := exec.LookPath("node"); err == nil { // développement : Node installé
		return p
	}
	return bundled
}

func startServer(base string, port int) error {
	logDir := filepath.Join(dataDir(), "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(logDir, "app.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	app := filepath.Join(base, "app")
	cmd := exec.Command(nodePath(base), filepath.Join(app, "server.mjs"), "--port", fmt.Sprint(port), "--exit-when-idle", idleSeconds)
	cmd.Dir = app
	cmd.Stdout, cmd.Stderr = log, log
	hideWindow(cmd)
	return cmd.Start() // le serveur continue après la fin du lanceur
}

func ensureServer(base string) (string, error) {
	for port := 4747; port <= 4767; port++ {
		switch check(port) {
		case probeLedger:
			return fmt.Sprintf("http://127.0.0.1:%d/", port), nil
		case probeBusy:
			continue
		}
		if err := startServer(base, port); err != nil {
			return "", fmt.Errorf("impossible de lancer le serveur : %w", err)
		}
		for i := 0; i < 80; i++ {
			time.Sleep(125 * time.Millisecond)
			if check(port) == probeLedger {
				return fmt.Sprintf("http://127.0.0.1:%d/", port), nil
			}
		}
		return "", fmt.Errorf("le serveur local n'a pas démarré, voir %s", filepath.Join(dataDir(), "logs", "app.log"))
	}
	return "", errors.New("aucun port libre entre 4747 et 4767")
}

func openWindow(url string) error {
	profile := filepath.Join(dataDir(), "window")
	for _, browser := range appBrowsers() {
		if _, err := os.Stat(browser); err != nil {
			continue
		}
		cmd := exec.Command(browser, "--app="+url, "--user-data-dir="+profile, "--window-size=1320,860",
			"--no-first-run", "--no-default-browser-check", "--disable-features=Translate")
		return cmd.Start()
	}
	return openDefault(url) // ni Edge ni Chrome : navigateur par défaut
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		fail(err)
	}
	base := filepath.Dir(exe)
	url, err := ensureServer(base)
	if err != nil {
		fail(err)
	}
	if err := openWindow(url); err != nil {
		fail(err)
	}
}

func fail(err error) {
	showError("Ledger n'a pas pu démarrer", err.Error()+"\n\nTes données ne sont pas touchées.")
	os.Exit(1)
}
