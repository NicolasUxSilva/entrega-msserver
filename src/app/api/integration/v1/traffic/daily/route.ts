/** GA4 por dia e canal — API de integração v1 (somente leitura). Ver docs/integracao-gestao-v1.md. */
import { trafficGET } from "@/server/integration/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = trafficGET;
