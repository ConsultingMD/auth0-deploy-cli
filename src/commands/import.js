import nconf from 'nconf';
import extTools from 'auth0-extension-tools';
import tools from 'auth0-source-control-extension-tools';
import log from '../logger';
import setupContext from '../context';

export default async function deploy(params) {
  const {
    input_file: inputFile,
    base_path: basePath,
    config_file: configFile,
    config: configObj,
    env,
    secret
  } = params;

  nconf.env().use('memory');

  if (configFile) {
    nconf.file(configFile);
  }

  const overrides = {
    AUTH0_INPUT_FILE: inputFile,
    AUTH0_BASE_PATH: basePath,
    AUTH0_CONFIG_FILE: configFile,
    AUTH0_KEYWORD_REPLACE_MAPPINGS: {},
    ...configObj || {}
  };

  // Prepare configuration by initializing nconf, then passing that as the provider to the config object
  // Allow passed in secret to override the configured one
  if (secret) {
    overrides.AUTH0_CLIENT_SECRET = secret;
  }

  if (env) {
    const mappings = nconf.get('AUTH0_KEYWORD_REPLACE_MAPPINGS') || {};
    nconf.set('AUTH0_KEYWORD_REPLACE_MAPPINGS', Object.assign(mappings, process.env));
  }

  nconf.overrides(overrides);

  // Setup context and load
  const context = await setupContext(nconf.get());
  await context.load();

  const config = extTools.config();
  config.setProvider(key => nconf.get(key));

  await tools.deploy(context.assets, context.mgmtClient, config);

  if (context.config.AUTH0_ALLOW_AUTO_ENABLE_DATABASE_CONNECTION) {
    log.info('Attempting to automatically enable the database connection for some clients');
    await updateEnabledClientsForDatabaseConnection(context);
    log.info(`Enabled database connection for '${context.config.AUTH0_DATABASE_CONNECTION_CLIENT_METAKEY}' clients`)
  }

  log.info('Import Successful');
}

async function updateEnabledClientsForDatabaseConnection({ mgmtClient, config}) {
  const connection = await mgmtClient.getConnection({ id: config.AUTH0_DATABASE_CONNECTION_ID })

  if (!connection) return

  const clients = await mgmtClient.getClients({ app_type: 'regular_web' });

  const filteredClients = clients.filter(client => {
    const metadata = client.client_metadata || {};
    return metadata[config.AUTH0_DATABASE_CONNECTION_CLIENT_METAKEY] === 'true'
  })

  if (!filteredClients.length) return

  const filteredClientIds = filteredClients.map(client => client.client_id)

  const currentEnabledClients = connection.enabled_clients || [];
  const updatedEnabledClients = [...new Set([...currentEnabledClients, ...filteredClientIds])];

  return await mgmtClient.updateConnection({ id: connection.id }, { enabled_clients: updatedEnabledClients })
}
