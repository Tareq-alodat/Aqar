import path from "node:path";
import { pathToFileURL } from "node:url";
import compression from "compression";
import express, { type RequestHandler } from "express";
import morgan from "morgan";
import { env, isProduction } from "./env";
import { createApiRouter } from "./api";
import { checkDatabase } from "./services/healthService";

const BUILD_PATH = path.resolve("build/server/index.js");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(morgan(isProduction ? "tiny" : "dev"));

app.use("/api/v1", createApiRouter({ isProduction, checkDatabase }));

// Local image storage is development-only; production uses object storage (SPEC §0).
if (!isProduction) {
  app.use("/uploads", express.static(path.resolve(env.UPLOAD_DIR)));
}

if (isProduction) {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { maxAge: "1h" }));
  const build = (await import(pathToFileURL(BUILD_PATH).href)) as { app: RequestHandler };
  app.use(build.app);
} else {
  console.log("Starting development server");
  const vite = await import("vite");
  const viteDevServer = await vite.createServer({
    server: { middlewareMode: true },
  });
  app.use(viteDevServer.middlewares);
  app.use(async (req, res, next) => {
    try {
      const source = (await viteDevServer.ssrLoadModule("./server/app.ts")) as {
        app: RequestHandler;
      };
      await source.app(req, res, next);
    } catch (error) {
      if (error instanceof Error) viteDevServer.ssrFixStacktrace(error);
      next(error);
    }
  });
}

app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}`);
});
