import Joi from 'joi';
import { createLogger } from '@surgio/logger';
import assert from 'assert';

import {
  ShadowsocksrNodeConfig,
  ShadowsocksrSubscribeProviderConfig,
  SubscriptionUserinfo,
} from '../types';
import { fromBase64 } from '../utils';
import relayableUrl from '../utils/relayable-url';
import { parseSubscriptionNode } from '../utils/subscription';
import { parseSSRUri } from '../utils/ssr';
import Provider from './Provider';

const logger = createLogger({
  service: 'surgio:ShadowsocksrSubscribeProvider',
});

export default class ShadowsocksrSubscribeProvider extends Provider {
  public readonly udpRelay?: boolean;
  private readonly _url: string;

  constructor(name: string, config: ShadowsocksrSubscribeProviderConfig) {
    super(name, config);

    const schema = Joi.object({
      url: Joi.string()
        .uri({
          scheme: [/https?/],
        })
        .required(),
      udpRelay: Joi.boolean().strict(),
    }).unknown();

    const { error } = schema.validate(config);

    // istanbul ignore next
    if (error) {
      throw error;
    }

    this._url = config.url;
    this.udpRelay = config.udpRelay;
    this.supportGetSubscriptionUserInfo = true;
  }

  // istanbul ignore next
  public get url(): string {
    return relayableUrl(this._url, this.relayUrl);
  }

  public async getSubscriptionUserInfo({
    requestUserAgent,
  }: { requestUserAgent?: string } = {}): Promise<
    SubscriptionUserinfo | undefined
  > {
    const { subscriptionUserinfo } = await getShadowsocksrSubscription(
      this.url,
      this.udpRelay,
      requestUserAgent || this.requestUserAgent,
    );

    if (subscriptionUserinfo) {
      return subscriptionUserinfo;
    }
    return undefined;
  }

  public async getNodeList({
    requestUserAgent,
  }: { requestUserAgent?: string } = {}): Promise<
    ReadonlyArray<ShadowsocksrNodeConfig>
  > {
    const { nodeList } = await getShadowsocksrSubscription(
      this.url,
      this.udpRelay,
      requestUserAgent || this.requestUserAgent,
    );

    return nodeList;
  }
}

export const getShadowsocksrSubscription = async (
  url: string,
  udpRelay?: boolean,
  requestUserAgent?: string,
): Promise<{
  readonly nodeList: ReadonlyArray<ShadowsocksrNodeConfig>;
  readonly subscriptionUserinfo?: SubscriptionUserinfo;
}> => {
  assert(url, '未指定订阅地址 url');

  const response = await Provider.requestCacheableResource(url, {
    requestUserAgent,
  });
  const nodeList = fromBase64(response.body)
    .split('\n')
    .filter((item) => !!item && item.startsWith('ssr://'))
    .map<ShadowsocksrNodeConfig>((str) => {
      const nodeConfig = parseSSRUri(str);

      if (udpRelay !== void 0) {
        (nodeConfig['udp-relay'] as boolean) = udpRelay;
      }

      return nodeConfig;
    });

  if (
    !response.subscriptionUserinfo &&
    nodeList[0].nodeName.includes('剩余流量')
  ) {
    const dataNode = nodeList[0];
    const expireNode = nodeList[1];
    response.subscriptionUserinfo = parseSubscriptionNode(
      dataNode.nodeName,
      expireNode.nodeName,
    );
    logger.debug(
      '%s received subscription node - raw: %s %s | parsed: %j',
      url,
      dataNode.nodeName,
      expireNode.nodeName,
      response.subscriptionUserinfo,
    );
  }

  return {
    nodeList,
    subscriptionUserinfo: response.subscriptionUserinfo,
  };
};
