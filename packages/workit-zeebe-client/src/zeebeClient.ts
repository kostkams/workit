// @ts-nocheck
/*
 * Copyright (c) 2020 Ville de Montreal. All rights reserved.
 * Licensed under the MIT license.
 * See LICENSE file in the project root for full license information.
 */
import { optional } from 'inversify';
import { IoC, PluginLoader, SERVICE_IDENTIFIER, NOOP_LOGGER } from '@mkostka/workit-core';
import {
  ICamundaService,
  IClient,
  ICreateWorkflowInstance,
  ICreateWorkflowInstanceResponse,
  IDeployWorkflowResponse,
  ILogger,
  IMessage,
  IPagination,
  IPaginationOptions,
  IPublishMessage,
  IUpdateWorkflowRetry,
  IUpdateWorkflowVariables,
  IWorkflow,
  IWorkflowClient,
  IWorkflowDefinition,
  IWorkflowDefinitionKey,
  IWorkflowDefinitionRequest,
  IWorkflowOptions,
  IWorkflowProcessIdDefinition,
  IWorkflowProps,
  IZeebeOptions,
}from '@mkostka/workit-types';
import { Configs, IAPIConfig as IElasticExporterConfig, ZBElasticClient } from '@mkostka/zeebe-elasticsearch-client';
import { ZBClient, ZBWorker } from 'zeebe-node';
// FIXME: dist folder
import { PaginationUtils } from './utils/paginationUtils';
import { ZeebeMessage } from './zeebeMessage';

export class ZeebeClient<TVariables = unknown, TProps = unknown, RVariables = TVariables>
  implements IClient<ICamundaService>, IWorkflowClient {
  private readonly _client: ZBClient;

  private readonly _exporterClient: ZBElasticClient;

  private _worker: ZBWorker<TVariables, TProps, RVariables> | undefined;

  private readonly _config: IZeebeOptions;

  private readonly _exporterConfig: Partial<IElasticExporterConfig> | undefined;

  constructor(config: IZeebeOptions, client?: ZBClient, exporterConfig?: Partial<IElasticExporterConfig>);

  constructor(config: IZeebeOptions, exporterConfig?: Partial<IElasticExporterConfig>);

  constructor(
    config: IZeebeOptions,
    @optional() client?: ZBClient | Partial<IElasticExporterConfig>,
    @optional() exporterConfig?: Partial<IElasticExporterConfig>
  ) {
    this._config = config;
    const pluginLoader = new PluginLoader(IoC, this._getLogger());
    if (config.plugins) {
      pluginLoader.load(config.plugins);
    }

    if (client && (client as Partial<IElasticExporterConfig>).url) {
      this._exporterConfig = client as Partial<IElasticExporterConfig>;
      this._client = new ZBClient(config.baseUrl, config);
    } else {
      this._client = (client || new ZBClient(config.baseUrl, config)) as ZBClient;
      this._exporterConfig = exporterConfig;
    }

    if (!exporterConfig) {
      // TODO: use real logger
      console.log(
        "warning: no exporterConfig has been provided to Zeebe. getWorkflow and getWorkflows methods won't work. "
      );
    }
    this._exporterClient = new ZBElasticClient(new Configs(exporterConfig));
  }

  public subscribe(
    onMessageReceived: (
      message: IMessage<TVariables, IWorkflowProps<TProps>>,
      service: ICamundaService
    ) => Promise<void>
  ): Promise<void> {
    this._worker = this._client.createWorker(
      this._config.workerId || 'some-random-id',
      this._config.topicName,
      async (payload, complete) => {
        const [message, service] = ZeebeMessage.wrap<TVariables, TProps>(payload, complete);
        await onMessageReceived(message, service);
      },
      this._config
    );
    return Promise.resolve();
  }

  public async deployWorkflow(bpmnPath: string): Promise<IDeployWorkflowResponse> {
    const result = await this._client.deployProcess(bpmnPath);
    return {
      workflows: result.workflows,
      key: result.key.toString(), // TODO: interface say number but it return string, need to PR to zeebe-node
    };
  }

  public async getWorkflows(options?: Partial<IWorkflowOptions & IPaginationOptions>): Promise<IPagination<IWorkflow>> {
    this._validateExporterConfig();
    const params = { _source_excludes: 'resource' };
    const workflowOptions = { params };
    workflowOptions.params = PaginationUtils.setElasticPaginationParams(params, options);
    const criteria = this._setWorkflowCriteria(options);
    const result = await this._exporterClient.getWorkflows(criteria, workflowOptions);
    const elasticResult = result.data.hits;
    const data = elasticResult.hits.map((doc) => {
      const workflow = doc._source;
      return {
        bpmnProcessId: workflow.value.bpmnProcessId,
        version: workflow.value.version,
        workflowKey: workflow.key.toString(),
        resourceName: workflow.value.resourceName,
      };
    });

    return {
      paging: PaginationUtils.getPagingFromOptions(elasticResult.total, options),
      items: data,
    };
  }

  public async getWorkflow(payload: IWorkflowDefinitionRequest): Promise<IWorkflowDefinition> {
    this._validateExporterConfig();
    this._validateObject();

    const key = Number((payload as IWorkflowDefinitionKey).workflowKey);
    const response = await this._exporterClient.getWorkflows({
      key: !Number.isNaN(key) ? key : undefined,
      bpmnProcessId: (payload as IWorkflowProcessIdDefinition).bpmnProcessId,
      version: (payload as IWorkflowProcessIdDefinition).version,
      latestVersion: typeof (payload as IWorkflowProcessIdDefinition).version !== 'number',
    });

    const data = response.data.hits.hits[0];

    if (!data) {
      throw new Error('Not found');
    }

    const doc = data._source;

    return {
      version: doc.value.version,
      resourceName: doc.value.resourceName,
      bpmnXml: doc.value.resource,
      workflowKey: doc.key.toString(),
      bpmnProcessId: doc.value.bpmnProcessId,
    };
  }

  public updateVariables<T = unknown>(model: IUpdateWorkflowVariables<Partial<T>>): Promise<void> {
    return this._client.setVariables<T>({
      elementInstanceKey: model.processInstanceId,
      variables: model.variables,
      local: !!model.local,
    });
  }

  public updateJobRetries(payload: IUpdateWorkflowRetry): Promise<void> {
    return this._client.updateJobRetries(payload);
  }

  /**
   * Publish a message event
   * If you don't specify correlationKey, message will be treated as message start event
   */
  public publishMessage<T = unknown>(payload: IPublishMessage<T, string>): Promise<void> {
    return this._client.publishMessage({
      correlationKey: payload.correlation || '__MESSAGE_START_EVENT__',
      variables: payload.variables,
      messageId: payload.messageId,
      timeToLive: payload.timeToLive,
      name: payload.name,
    });
  }

  public createWorkflowInstance<T = unknown>(
    model: ICreateWorkflowInstance<T>
  ): Promise<ICreateWorkflowInstanceResponse> {
    if (!model.version) {
      return this._client.createProcessInstance<T>(model.bpmnProcessId, model.variables);
    }
    return this._client.createWorkflowInstance<T>(model as Required<ICreateWorkflowInstance<T>>);
  }

  public cancelWorkflowInstance(instance: string): Promise<void> {
    this._validateNumber(instance);
    return this._client.cancelProcessInstance(instance as any); // TODO: will be fixed https://github.com/zeebe-io/zeebe/issues/2680
  }

  public resolveIncident(incidentKey: string): Promise<void> {
    return this._client.resolveIncident(incidentKey);
  }

  public unsubscribe(): Promise<void> {
    if (this._worker) {
      return this._worker.close();
    }
    return Promise.resolve();
  }

  private _validateExporterConfig() {
    if (!this._exporterConfig) {
      throw new Error(`
      Please, refer to the warning when you instiate this class. You must pass exporterConfig to the Ctor in order to use this method.
      For now, we are only compatible with elastic indexes that operate produce. If you use different indexes or different exporter, please raise an issue.
      `);
    }
  }

  private _validateObject() {
    if (!this._exporterConfig) {
      throw new Error(`
        Object passed to the method can't be undefined
      `);
    }
  }

  private _validateNumber(variable: string) {
    const value = Number(variable);
    if (!Number.isInteger(value)) {
      throw new Error(`
      workflowInstanceKey value is malformed
      `);
    }
  }

  private _setWorkflowCriteria(options?: Partial<IWorkflowOptions & IPaginationOptions>) {
    if (!options) {
      return {};
    }
    return { bpmnProcessId: options.bpmnProcessId };
  }

  private _getLogger(): ILogger {
    try {
      return IoC.get(SERVICE_IDENTIFIER.logger);
    } catch (error) {
      return NOOP_LOGGER;
    }
  }
}
