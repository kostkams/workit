/*
 * Copyright (c) 2020 Ville de Montreal. All rights reserved.
 * Licensed under the MIT license.
 * See LICENSE file in the project root for full license information.
 */

import axios from 'axios';
import { TaskBase } from '@mkostka/workit-core';
import { IMessage }from '@mkostka/workit-types';

export class HelloWorldTask extends TaskBase<IMessage> {
  public async execute(message: IMessage): Promise<IMessage> {
    const { properties } = message;

    console.log();
    console.log(`Executing task: ${properties.activityId}`);
    console.log(`${properties.bpmnProcessId}::${properties.processInstanceId} Servus!`);

    const response = await axios.get('https://jsonplaceholder.typicode.com/todos/1');

    console.log('\ndata:');
    console.log(response.data);

    return message;
  }
}
