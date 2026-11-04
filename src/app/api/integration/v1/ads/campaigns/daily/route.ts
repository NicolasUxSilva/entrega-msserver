/** Mídia paga por dia e campanha — API de integração v1 (somente leitura). Ver docs/integracao-gestao-v1.md. */
import { adCampaignsGET } from "@/server/integration/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = adCampaignsGET;
