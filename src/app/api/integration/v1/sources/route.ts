/** Estado e cobertura de cada fonte — API de integração v1 (somente leitura). Ver docs/integracao-gestao-v1.md. */
import { sourcesGET } from "@/server/integration/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = sourcesGET;
