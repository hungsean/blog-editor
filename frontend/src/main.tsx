import React from "react";
import { createRoot } from "react-dom/client";
import "flatpickr/dist/flatpickr.min.css";
import "highlight.js/styles/github-dark.css";
import "./styles/app.css";
import { ListPage } from "./pages/ListPage";
import { EditorPage } from "./pages/EditorPage";

function App() {
  const path = window.location.pathname;
  if (path.startsWith("/editor")) {
    const id = path.split("/").filter(Boolean)[1] ?? null;
    return <EditorPage draftId={id} />;
  }
  return <ListPage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
