// Database queries for different export scenarios

export const DB_QUERIES = {
  // Main export query with all data
  FULL_EXPORT: `
    SELECT
      pr.*,
      b.name AS brand_name,
      pb.name AS parent_brand_name,
      co.code AS produce_country_code,
      co.name AS produce_country_name,
      con.name AS contractor_name,
      con."TIN" AS contractor_tin_number,
      pd.external_number AS contract_number,
      pd.internal_number,
      pd.date AS document_date,
      rp.folder_id AS request_position_folder_id,
      rp.status_id AS request_position_status_id,
      ps.internal_name AS product_status_internal_name,
      ps.external_name AS product_status_external_name,
      rp.legal_approve AS request_position_legal_approve,
      rp.legal_req AS request_position_legal_req,
      rf.id AS folder_id,
      rf.creator_sub AS folder_creator_sub,
      rf.creation_datetime AS folder_creation_datetime,
      rt.name AS folder_type_name,
      rf.business_unit_id AS folder_business_unit_id,
      rf.category_id AS folder_category_id,
      pc.name AS folder_category_name,
      pg.code as product_group_code,
      pg.name as product_group_name,
      rf.promo_id AS folder_promo_id,
      rf.change_datetime AS folder_change_datetime
      
    FROM product_requests pr
    JOIN request_positions rp ON pr.request_position_id = rp.id
    JOIN request_folders rf ON rp.folder_id = rf.id
    LEFT JOIN brands b ON pr.brand_id = b.id
    LEFT JOIN brands pb ON pr.parent_brand_id = pb.id
    LEFT JOIN product_categories pc ON rf.category_id = pc.id
    LEFT JOIN product_groups pg ON pr.group_id = pg.id
    LEFT JOIN request_types rt ON rf.type_id = rt.id
    LEFT JOIN product_statuses ps ON rp.status_id = ps.id
    LEFT JOIN countries co ON pr.produce_country_id = co.id
    LEFT JOIN contractors con ON pr."TIN" = con.id
    LEFT JOIN product_documents pd ON pr.id = pd.product_request_id
  `,

  // Minimal export for specific use cases
  MINIMAL_EXPORT: `
    SELECT
      pr.id AS request_position_id,
      pr.barcode,
      pr.name_by_doc,
      pr.icpu_code,
      rp.status_id AS request_position_status_id,
      rp.folder_id AS request_position_folder_id,
      rf.category_id AS folder_category_id,
      pc.name AS folder_category_name,
      con.name AS contractor_name
    FROM product_requests pr
    JOIN request_positions rp ON pr.request_position_id = rp.id
    JOIN request_folders rf ON rp.folder_id = rf.id
    LEFT JOIN product_categories pc ON rf.category_id = pc.id
    LEFT JOIN contractors con ON pr."TIN" = con.id
  `
} as const;

export type QueryType = keyof typeof DB_QUERIES;

export function getQuery(type: QueryType = 'FULL_EXPORT'): string {
  return process.env.DB_GOOGLE_SHEET_QUERY || DB_QUERIES[type];
}