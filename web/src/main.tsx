import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import { App } from "./App";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Pool root element is missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
