import type { Request, RequestHandler, Response } from "express";
import type { Knex } from "knex";
import type { AppLoadContext } from "react-router";
import { requestMeta } from "./middleware/authenticate";
import type { AuthCookies } from "./services/authCookies";
import type { AuthService, RequestMeta, Session } from "./services/authService";

/** Server services that page loaders/actions use (created once in server/index.ts). */
export interface AppServices {
  auth: AuthService;
  cookies: AuthCookies;
  /** Database for page loaders (map search SSR); public loaders use the same services as /api/v1. */
  db: Knex;
}

declare module "react-router" {
  interface AppLoadContext {
    /** Signed-in session for this request (server only; pages get `ClientUser` from the root loader). */
    session: Session | null;
    services: AppServices;
    meta: RequestMeta;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      services?: AppServices;
    }
  }
}

/** Makes the services available to `getLoadContext` (set before the React Router handler). */
export function provideServices(services: AppServices): RequestHandler {
  return (_req, res, next) => {
    res.locals.services = services;
    next();
  };
}

export function getLoadContext(req: Request, res: Response): AppLoadContext {
  const services = res.locals.services;
  if (!services) throw new Error("App services are not set (provideServices must run first)");
  return { session: res.locals.session ?? null, services, meta: requestMeta(req) };
}
