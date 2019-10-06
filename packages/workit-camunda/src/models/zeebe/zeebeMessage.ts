/*!
 * Copyright (c) 2019 Ville de Montreal. All rights reserved.
 * Licensed under the MIT license.
 * See LICENSE file in the project root for full license information.
 */

import { FailureException, ICamundaService, IMessage, IPayload, IWorkflowProps } from 'workit-types';
// FIXME:dist folder....
import { CompleteFn } from 'zeebe-node/dist/lib/interfaces';
import { getVariablesWhenChanged } from '../../utils/utils';
import { ZeebeMapperProperties } from './zeebeMapperProperties';

export class ZeebeMessage {
  public static wrap<TVariables, TProps>(
    payload: IPayload<TVariables, TProps>,
    complete: CompleteFn<TVariables>
  ): [IMessage<TVariables, IWorkflowProps<TProps>>, ICamundaService] {
    const properties = ZeebeMapperProperties.map(payload);
    return [
      {
        body: payload.variables,
        properties
      },
      {
        hasBeenThreated: false,
        async ack(message: IMessage<Partial<TVariables> | undefined, IWorkflowProps<unknown>>) {
          if (this.hasBeenThreated) {
            return Promise.resolve();
          }

          // TODO: change any to real type body
          const vars = getVariablesWhenChanged<any>(message, msg => ZeebeMessage.unwrap(msg));

          if (vars) {
            this.hasBeenThreated = complete.success(vars.variables);
          } else {
            this.hasBeenThreated = complete.success();
          }

          return Promise.resolve();
        },
        async nack(error: FailureException) {
          if (this.hasBeenThreated) {
            return Promise.resolve();
          }
          const retries = error.retries;
          this.hasBeenThreated = complete.failure(error.message, retries);
          return Promise.resolve();
        }
      }
    ];
  }

  /**
   * Shallow copy
   */
  public static unwrap<TVariables, TProps>(
    message: IMessage<TVariables, IWorkflowProps<TProps>>
  ): IPayload<TVariables, TProps> {
    const emptyPayload = ZeebeMapperProperties.unmap<TProps>(message.properties);
    (emptyPayload as IPayload<TVariables, TProps>).variables = message.body;
    return emptyPayload as IPayload<TVariables, TProps>;
  }
}
