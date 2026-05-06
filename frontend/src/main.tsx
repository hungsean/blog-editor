import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import ListPage from "./pages/list";

function App() {
  return <ListPage></ListPage>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
