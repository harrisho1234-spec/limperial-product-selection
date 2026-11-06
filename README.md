# L'Imperial Product Selection Studio

Independent Asfour catalog-selection web app. This is **not** the L'Imperial Showroom project.

## Publish via GitHub Pages

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main**, folder **/(root)**, and click **Save**.
4. Open the separate site at `https://harrisho1234-spec.github.io/limperial-product-selection/` after Pages reports a successful deployment.

## Private catalog setup

Supplier catalogs and purchasing data are intentionally **not** committed to this public repository. Download `Asfour_Catalog_Private_Pack.json` from your private Google Drive workspace (L'Imperial Product Selection → App Assets), then click **Import catalog pack** inside this app.

Selections are saved to this browser/device only. Use the **Backup** feature to preserve a copy. Automatic Google Sheets / cross-device syncing is not yet connected.

## Important separation

- Existing Showroom source: `harrisho1234-spec/limperial-showroom`
- This independent app: `harrisho1234-spec/limperial-product-selection`

Do not upload supplier catalog PDFs, product price lists, private selection JSON, or private purchasing data to the public repository.

## Confidential Asfour supplier list-price references

The Asfour 2025 PDF list-price codes (1,063) and the 2022 historical PDF price references (949; 300 codes not in the current catalog) are stored only in the Supabase table `public.product_selection_supplier_list_prices`. **Do not upload PDF price lists, spreadsheet price exports, or price JSON to this public repository.**

- RLS permits SELECT only for active Product Selection **Super Admin / Admin** members. Anonymous and staff accounts cannot query this table.
- In Asfour **Discover** or **Design families**, use **Show Asfour list prices · Admin** to retrieve the prices after verifying your Supabase staff account. **Hide** clears the visible reference cache.
- In **Team selections**, Admin **Show / hide costs** shows the separate supplier list-price reference and the existing manually entered actual unit cost; staff exports never include either.
- Full supplier-code matching includes finish/crystal suffixes. 2025 takes precedence. A 2022-only price is explicitly marked historical.
- The PDFs provide **listed USD prices, not negotiated net purchase cost or landed cost**. Existing actual-cost records are never auto-populated or overwritten.
