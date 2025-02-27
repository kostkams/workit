import { SERVICE_IDENTIFIER as CORE_IDENTIFIER } from '@mkostka/workit-camunda';
import { IoC } from '@mkostka/workit-core';
import { configs } from '.';
import { HelloWorldTask } from '../tasks/helloWorldTask';

enum LOCAL_IDENTIFIER {
  sampleActivity = 'sample_activity',
}

IoC.bindTo(HelloWorldTask, LOCAL_IDENTIFIER.sampleActivity);
IoC.bindToObject(configs.camunda, CORE_IDENTIFIER.camunda_external_config);
