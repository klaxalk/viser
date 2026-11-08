import ReactDOM from "react-dom/client";
import { Root } from "./App";
// ModelForge: the page-level additions (src/mf/).
import "./mf";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />,
);
