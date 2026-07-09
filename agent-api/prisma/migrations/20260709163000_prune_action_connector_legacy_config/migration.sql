UPDATE "integration_instance_configs" cfg
SET "config" =
  cfg."config"
    - 'runtimeInstruction'
    - 'baseUrl'
    - 'healthPath'
    - 'delegationHeader'
    - 'actionListPath'
    - 'actionSearchPath'
    - 'actionDescribePath'
    - 'actionPreviewPath'
    - 'actionExecutePath'
    - 'identityPath'
FROM "integration_instances" inst
WHERE inst."id" = cfg."integration_instance_id"
  AND inst."type" = 'action_connector';
