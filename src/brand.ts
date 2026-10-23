/**
 * Identidade da instalação — PONTO ÚNICO de marca desta entrega (MS Server).
 *
 * Só contém o que é verificável hoje: o nome da empresa. Logotipo, cores oficiais e nome
 * de produto NÃO foram fornecidos e por isso NÃO foram inventados — ver
 * `docs/entrega-ms-server.md` §"Identidade visual (pendente)". Para aplicá-los:
 *  - logotipo: coloque o arquivo em `public/brand/` e preencha `logo` abaixo;
 *  - cores: ajuste os tokens `--primary`, `--sidebar-*` etc. em `src/app/globals.css`
 *    (o bloco está marcado "MARCA");
 *  - nome de produto: preencha `productName`.
 */
export interface Brand {
  /** nome da empresa — exibido na barra lateral, no login e no título das páginas */
  companyName: string;
  /** nome do produto, se a empresa definir um; `null` = só o nome da empresa */
  productName: string | null;
  /** logotipo fornecido pela empresa (em `public/brand/`); `null` = nome em texto */
  logo: { src: string; alt: string; width: number; height: number } | null;
  /** descrição curta (metadados da página) */
  description: string;
  /** identificador técnico da instalação (health check, logs) */
  serviceId: string;
}

export const BRAND: Brand = {
  companyName: "MS Server",
  productName: null,
  logo: null,
  description: "Análise e diagnóstico de campanhas e de marketing",
  serviceId: "ms-server-marketing",
};

/** Nome exibido: "Produto · Empresa" quando há produto, senão só a empresa. */
export const displayName = BRAND.productName ? `${BRAND.productName} · ${BRAND.companyName}` : BRAND.companyName;

/** Título da aba do navegador: "Página — Nome". */
export function pageTitle(page?: string): string {
  return page ? `${page} — ${displayName}` : displayName;
}
