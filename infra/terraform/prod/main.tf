module "site" {
  source = "github.com/collinbentley1/platform//terraform/modules/cloud-run-service?ref=d4c1bcf6e5700d2a4f75d96b9e09eb122e4d1672"
  providers = {
    google                = google
    google.no_attribution = google.no_attribution
  }
  app                                            = "virtual-care-mcp"
  project_id                                     = var.project_id
  region                                         = var.region
  service_name                                   = var.service_name
  artifact_registry_repository_id                = var.artifact_registry_repository_id
  artifact_registry_description                  = "Container images for Virtual Care MCP."
  bootstrap_image                                = var.bootstrap_image
  bootstrap_runtime_service_account_email        = var.bootstrap_runtime_service_account_email
  runtime_service_account_email                  = var.runtime_service_account_email
  preview_runtime_service_account_email          = var.preview_runtime_service_account_email
  preview_ingress                                = var.preview_ingress
  prod_deploy_service_account_email              = var.prod_deploy_service_account_email
  prod_publisher_service_account_email           = var.prod_publisher_service_account_email
  deployment_parity_reader_service_account_email = var.deployment_parity_reader_service_account_email
  preview_deploy_service_account_email           = var.preview_deploy_service_account_email
  preview_commit_service_account_email           = var.preview_commit_service_account_email
  preview_operator_service_account_email         = var.preview_operator_service_account_email
  preview_publisher_service_account_email        = var.preview_publisher_service_account_email
  container_env = {
    VISIT_STORE          = "firestore"
    FIRESTORE_PROJECT_ID = "virtual-care-mcp"
    PUBLIC_BASE_URL      = "https://virtual-care-mcp-894875537243.us-east4.run.app"
  }
  runtime_secret_ids               = var.runtime_secret_ids
  runtime_secret_accessor_ids      = var.runtime_secret_accessor_ids
  runtime_secret_version_adder_ids = var.runtime_secret_version_adder_ids
  firestore_database = {
    name                         = "(default)"
    location_id                  = "us-east4"
    runtime_collection_env_name  = "FIRESTORE_COLLECTION"
    runtime_collection_env_value = "visits"
  }
}
resource "google_firestore_field" "virtual_care_visit_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "visits"
  field      = "expiresAt"

  ttl_config {}
  index_config {}

  depends_on = [module.site]
}
