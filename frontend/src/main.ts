import { createApp } from "vue";
import App from "./App.vue";
import { initConsent as initConsentimento } from "./consentimento";
import "./estilo.css";

createApp(App).mount("#app");
initConsentimento("/privacidade.html");
