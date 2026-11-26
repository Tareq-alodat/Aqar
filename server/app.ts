import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { getLoadContext } from "./loadContext";

// React Router request handler. Loaded through Vite in development and
// bundled into build/server/index.js for production (see vite.config.ts).
// server/index.ts runs `provideServices` and `authenticate` before it.
export const app = express();

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext,
  }),
);
