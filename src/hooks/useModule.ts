import {useSpringboardEngine} from 'springboard/engine/engine';
import {AllModules} from 'springboard/module_registry/module_registry';

export const useModule = <ModuleId extends keyof AllModules>(moduleId: ModuleId): AllModules[ModuleId] => {
    const engine = useSpringboardEngine();
    return engine.moduleRegistry.getModule(moduleId);
};