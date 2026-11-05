package app.ledger;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ledger pour Android : l'interface et le moteur (base SQLite, calculs, synchro) tournent dans une WebView,
 * servie depuis les fichiers de l'app sous http://localhost/. Cette classe ne fournit que ce qu'une page web
 * ne sait pas faire : fichiers privés, recherche du Mac sur le Wi-Fi, téléchargements, couleur des barres.
 */
public class MainActivity extends Activity {
    private static final String ORIGIN = "http://localhost/";
    private static final int PICK_FILE = 1;
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "text/javascript"); MIME.put("css", "text/css");
        MIME.put("json", "application/json"); MIME.put("png", "image/png"); MIME.put("svg", "image/svg+xml");
        MIME.put("wasm", "application/wasm"); MIME.put("ico", "image/x-icon");
    }

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0d1113"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " LedgerAndroid/" + versionName());
        web.addJavascriptInterface(new Bridge(), "LedgerNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!"localhost".equals(u.getHost()) || u.getPort() != -1) return null;
                return asset(u.getPath());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if ("localhost".equals(req.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(Intent.createChooser(pick, "Choisir un fichier"), PICK_FILE); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        if (state == null) web.loadUrl(ORIGIN + "index.html");
        else web.restoreState(state);
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = getAssets().open("www" + path);
            String ext = path.substring(path.lastIndexOf('.') + 1);
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text") || ext.equals("json") ? "utf-8" : null, in);
            r.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }
    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.ledgerFlush && ledgerFlush()", null);
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.ledgerBack ? ledgerBack() : false", v -> { if (!"true".equals(v)) moveTaskToBack(true); });
    }

    private void js(String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }

    // ---------- pont appelé par android/web/shims ----------
    private class Bridge {
        private final File root = getFilesDir();

        private File file(String path) throws IOException {
            if (path == null || path.contains("..")) throw new IOException("Chemin refusé");
            return new File(root, path.startsWith("/") ? path.substring(1) : path);
        }

        @JavascriptInterface public String readFile(String path) {
            try (InputStream in = new FileInputStream(file(path))) {
                return Base64.encodeToString(readAll(in), Base64.NO_WRAP);
            } catch (IOException e) { return null; }
        }

        @JavascriptInterface public boolean writeFile(String path, String b64) {
            try {
                File f = file(path), tmp = new File(f.getPath() + ".tmp");
                File dir = f.getParentFile();
                if (dir != null) dir.mkdirs();
                try (OutputStream out = new FileOutputStream(tmp)) {
                    out.write(Base64.decode(b64, Base64.NO_WRAP));
                    ((FileOutputStream) out).getFD().sync();
                }
                return tmp.renameTo(f); // remplacement atomique : jamais de base à moitié écrite
            } catch (IOException e) { return false; }
        }

        @JavascriptInterface public boolean exists(String path) {
            try { return file(path).exists(); } catch (IOException e) { return false; }
        }

        @JavascriptInterface public boolean mkdirs(String path) {
            try { File f = file(path); return f.isDirectory() || f.mkdirs(); } catch (IOException e) { return false; }
        }

        @JavascriptInterface public boolean remove(String path, boolean recursive) {
            try { return delete(file(path), recursive); } catch (IOException e) { return false; }
        }
        private boolean delete(File f, boolean recursive) {
            if (recursive && f.isDirectory()) { File[] kids = f.listFiles(); if (kids != null) for (File k : kids) delete(k, true); }
            return f.delete();
        }

        @JavascriptInterface public String list(String path) {
            try {
                String[] names = file(path).list();
                if (names == null) return null;
                JSONArray a = new JSONArray();
                for (String n : names) if (!n.endsWith(".tmp")) a.put(n);
                return a.toString();
            } catch (IOException e) { return null; }
        }

        @JavascriptInterface public String stat(String path) {
            try {
                File f = file(path);
                if (!f.exists()) return null;
                return new JSONObject().put("size", f.length()).put("mtime", f.lastModified()).put("dir", f.isDirectory()).toString();
            } catch (Exception e) { return null; }
        }

        @JavascriptInterface public boolean rename(String from, String to) {
            try { return file(from).renameTo(file(to)); } catch (IOException e) { return false; }
        }

        @JavascriptInterface public boolean copy(String from, String to) {
            try (InputStream in = new FileInputStream(file(from))) {
                return writeFile(to, Base64.encodeToString(readAll(in), Base64.NO_WRAP));
            } catch (IOException e) { return false; }
        }

        @JavascriptInterface public String deviceName() {
            String n = Settings.Global.getString(getContentResolver(), "device_name");
            return n != null && !n.isEmpty() ? n : Build.MODEL;
        }

        /** Cherche les Mac Ledger sur le Wi-Fi (diffusion UDP), répond plus tard via __ledgerNativeResolve. */
        @JavascriptInterface public void discover(String id, int port, int timeout) {
            new Thread(() -> {
                JSONArray found = new JSONArray();
                try (DatagramSocket sock = new DatagramSocket()) {
                    sock.setBroadcast(true);
                    sock.setSoTimeout(150);
                    Set<InetAddress> targets = new LinkedHashSet<>();
                    targets.add(InetAddress.getByName("255.255.255.255"));
                    for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                        if (!ni.isUp() || ni.isLoopback()) continue;
                        for (InterfaceAddress a : ni.getInterfaceAddresses()) if (a.getBroadcast() != null) targets.add(a.getBroadcast());
                    }
                    byte[] ask = "LEDGER?".getBytes(StandardCharsets.UTF_8);
                    long end = System.currentTimeMillis() + timeout;
                    long[] sends = { 0, 300, 800 };
                    long start = System.currentTimeMillis();
                    int sent = 0;
                    byte[] buf = new byte[512];
                    while (System.currentTimeMillis() < end) {
                        if (sent < sends.length && System.currentTimeMillis() - start >= sends[sent]) {
                            for (InetAddress t : targets) { try { sock.send(new DatagramPacket(ask, ask.length, t, port)); } catch (IOException ignored) { } }
                            sent++;
                        }
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        try {
                            sock.receive(p);
                            found.put(new JSONObject().put("msg", new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8)).put("address", p.getAddress().getHostAddress()));
                        } catch (SocketTimeoutException ignored) { }
                    }
                } catch (Exception ignored) { }
                js("window.__ledgerNativeResolve(" + JSONObject.quote(id) + "," + JSONObject.quote(found.toString()) + ")");
            }).start();
        }

        /** Enregistre un export dans Téléchargements. Renvoie "" ou le message d'erreur. */
        @JavascriptInterface public String saveDownload(String name, String mime, String b64) {
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime.split(";")[0]);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("Téléchargements inaccessibles");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(Base64.decode(b64, Base64.NO_WRAP)); }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Enregistré dans Téléchargements : " + name, Toast.LENGTH_LONG).show());
                return "";
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Export impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
                return e.getMessage();
            }
        }

        /** Barres système de la couleur du fond de l'app : "rgb(r, g, b)". */
        @JavascriptInterface public void setBars(String css) {
            Matcher m = Pattern.compile("(\\d+)\\D+(\\d+)\\D+(\\d+)").matcher(css == null ? "" : css);
            if (!m.find()) return;
            int r = Integer.parseInt(m.group(1)), g = Integer.parseInt(m.group(2)), b = Integer.parseInt(m.group(3));
            int color = Color.rgb(r, g, b);
            boolean light = (0.299 * r + 0.587 * g + 0.114 * b) > 150;
            runOnUiThread(() -> {
                Window w = getWindow();
                w.setStatusBarColor(color);
                w.setNavigationBarColor(color);
                web.setBackgroundColor(color);
                if (Build.VERSION.SDK_INT >= 30) {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    w.getInsetsController().setSystemBarsAppearance(light ? mask : 0, mask);
                } else {
                    View d = w.getDecorView();
                    int f = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    d.setSystemUiVisibility(light ? d.getSystemUiVisibility() | f : d.getSystemUiVisibility() & ~f);
                }
            });
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
