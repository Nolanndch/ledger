// App iPhone : même moteur que l'app Android (android/web/runtime.js), avec le pont natif de l'app iOS.
// L'ordre des imports compte : le pont doit exister avant que les shims le lisent, et fetch doit être
// remplacé avant que le moteur ne le capture.
import "./native-bridge.js";
import "./fetch.js";
import "../../android/web/runtime.js";
