/**
 * Marca da instalação (barra lateral e login): o logotipo configurado em `src/brand.ts`
 * ou, enquanto a empresa não fornecer um, o nome em texto. Nada é desenhado aqui.
 */
import { BRAND, displayName } from "@/brand";

export function BrandMark({ className }: { className?: string }) {
  if (BRAND.logo) {
    return (
      // logotipo estático do próprio projeto (public/brand) — sem otimização remota
      // eslint-disable-next-line @next/next/no-img-element
      <img src={BRAND.logo.src} alt={BRAND.logo.alt} width={BRAND.logo.width} height={BRAND.logo.height} className={className} />
    );
  }
  return <span className={className}>{displayName}</span>;
}
