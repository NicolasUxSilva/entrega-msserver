/** Estado da credencial e do workspace — API de integração v1 (somente leitura). Ver docs/integracao-gestao-v1.md. */
import { healthGET } from "@/server/integration/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = healthGET;
