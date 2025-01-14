/*
 * Copyright (c) 2020 Ville de Montreal. All rights reserved.
 * Licensed under the MIT license.
 * See LICENSE file in the project root for full license information.
 */

import { SpanContext } from '@opentelemetry/api';
import { IMessageBase, ITracerPropagator }from '@mkostka/workit-types';

export class NoopTracerPropagator implements ITracerPropagator {
  public extractFromMessage(message: IMessageBase<{ requestInfo: unknown }>): SpanContext | undefined {
    return undefined;
  }
}
