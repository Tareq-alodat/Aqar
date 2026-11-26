import { Router, type Response } from "express";
import { z } from "zod";
import { DEFAULT_COUNTRY, toCountryCode } from "../../app/shared/countries";
import { DEFAULT_LOCALE } from "../../app/shared/locales";
import { AUTH_ERROR_STATUS, fieldErrors, loginSchema, registerSchema } from "../../app/shared/schemas/auth";
import { activeCountrySchema, localeSchema } from "../../app/shared/schemas/routeParams";
import { DEFAULT_THEME, themeSchema } from "../../app/shared/schemas/theme";
import { appendCookies, requestMeta, setSessionCookies } from "../middleware/authenticate";
import { requireAuth } from "../middleware/requireAuth";
import type { AuthCookies } from "../services/authCookies";
import type { AuthFailure, AuthService, SessionUser } from "../services/authService";

export interface AuthApiDeps {
  service: AuthService;
  cookies: AuthCookies;
}

/** The caller's own account (explicit fields; never phone, hashes or tokens). */
function selfView(user: SessionUser) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, locale: user.locale, companyId: user.companyId };
}

function sendFailure(res: Response, failure: AuthFailure) {
  if (failure.retryAfterS) res.set("Retry-After", String(failure.retryAfterS));
  res.status(AUTH_ERROR_STATUS[failure.error]).json({ error: failure.error });
}

/** Where a registration comes from: country (phone rules), locale and theme. */
const registerContextSchema = z.object({
  country: activeCountrySchema.default(DEFAULT_COUNTRY),
  locale: localeSchema.default(DEFAULT_LOCALE),
  theme: themeSchema.default(DEFAULT_THEME),
});

/** /api/v1/auth (SPEC §13). Mounted after `authenticate`, so res.locals.session is set. */
export function authRouter({ service, cookies }: AuthApiDeps): Router {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const context = registerContextSchema.safeParse(req.body ?? {});
      if (!context.success) {
        res.status(400).json({ error: "invalid_input" });
        return;
      }
      const countryCode = toCountryCode(context.data.country);
      const input = registerSchema(countryCode).safeParse(req.body ?? {});
      if (!input.success) {
        res.status(400).json({ error: "invalid_input", fields: fieldErrors(input.error) });
        return;
      }
      const result = await service.register(
        input.data,
        { countryCode, locale: context.data.locale, theme: context.data.theme },
        requestMeta(req),
      );
      if (!result.ok) {
        sendFailure(res, result);
        return;
      }
      setSessionCookies(res, cookies, result.issued);
      res.status(201).json({ user: selfView(result.session.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const input = loginSchema.safeParse(req.body ?? {});
      if (!input.success) {
        res.status(400).json({ error: "invalid_input", fields: fieldErrors(input.error) });
        return;
      }
      const result = await service.login(input.data, requestMeta(req));
      if (!result.ok) {
        sendFailure(res, result);
        return;
      }
      setSessionCookies(res, cookies, result.issued);
      res.json({ user: selfView(result.session.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/refresh", async (req, res, next) => {
    try {
      const result = await service.refresh(cookies.read(req.headers.cookie).refresh, requestMeta(req));
      if (!result.session) {
        appendCookies(res, cookies.clear());
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      if (result.issued) setSessionCookies(res, cookies, result.issued);
      res.json({ user: selfView(result.session.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      await service.logout(cookies.read(req.headers.cookie), res.locals.session);
      // Replace any cookies `authenticate` may have set on this request.
      res.removeHeader("Set-Cookie");
      appendCookies(res, cookies.clear());
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, (_req, res) => {
    res.json({ user: selfView(res.locals.session!.user) });
  });

  return router;
}
