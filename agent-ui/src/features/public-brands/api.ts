import { api } from "../../lib/api";
import type { PublicBrandInput, PublicBrandLookups, PublicBrandReadiness, PublicBrandRecord } from "./types";

export async function fetchPublicBrands(): Promise<PublicBrandRecord[]> {
  const response = await api<{ brands: PublicBrandRecord[] }>("/api/admin/brands");
  return response.brands;
}

export function fetchPublicBrandLookups(): Promise<PublicBrandLookups> {
  return api<PublicBrandLookups>("/api/admin/brands/lookups");
}

export async function createPublicBrand(input: PublicBrandInput): Promise<PublicBrandRecord> {
  const response = await api<{ brand: PublicBrandRecord }>("/api/admin/brands", { method: "POST", json: input });
  return response.brand;
}

export async function updatePublicBrand(id: string, input: PublicBrandInput): Promise<PublicBrandRecord> {
  const response = await api<{ brand: PublicBrandRecord }>(`/api/admin/brands/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: input
  });
  return response.brand;
}

export async function checkPublicBrand(id: string): Promise<PublicBrandReadiness> {
  const response = await api<{ readiness: PublicBrandReadiness }>(
    `/api/admin/brands/${encodeURIComponent(id)}/check`,
    { method: "POST" }
  );
  return response.readiness;
}

export async function regeneratePublicBrandProjection(id: string): Promise<PublicBrandRecord> {
  const response = await api<{ brand: PublicBrandRecord }>(
    `/api/admin/brands/${encodeURIComponent(id)}/knowledge-projection`,
    { method: "POST" }
  );
  return response.brand;
}
