import React from "react";
import { createRoot } from "react-dom/client";
import { Switch, Route } from "wouter";
import "./styles.css";
import ListPage from "./pages/list";
import EditorPage from "./pages/editor";

function App() {
  return (
    <Switch>
      <Route path="/" component={ListPage} />
      <Route path="/editor/:id">
        {(params) => <EditorPage key={params.id} id={params.id} />}
      </Route>
      <Route path="/editor">
        {() => <EditorPage />}
      </Route>
    </Switch>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
