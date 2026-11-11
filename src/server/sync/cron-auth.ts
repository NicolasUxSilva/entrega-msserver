/**
 * Autorização da rota de cron. A Vercel envia `Authorization: Bearer <CRON_SECRET>` nas
 * chamadas agendadas quando a variável existe. Sem `CRON_SECRET`, a rota fica desligada.
 * Segredo PRÓPRIO: não é o `AUTH_SECRET` nem uma credencial da API de integração.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuth = "ok" | "disabled" | "unauthorized";

export function checkCronAuth(authorization: string | null, secret: string | undefined): CronAuth {
  if (!secret) return "disabled";
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const given = createHash("sha256").update(authorization ?? "").digest();
  return timingSafeEqual(expected, given) ? "ok" : "unauthorized";
}
