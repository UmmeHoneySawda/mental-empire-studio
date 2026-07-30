import {
  TemplateRegistry,
  type TemplateFilter,
  type TemplateInstantiation,
  type InstantiateTemplateInput,
  type TemplateManifest
} from '../../../../shared/video-engine'
import { BUILTIN_VIDEO_TEMPLATES } from './builtins'

export class VideoTemplateRegistry {
  private readonly registry: TemplateRegistry

  constructor(additional: readonly TemplateManifest[] = []) {
    this.registry = new TemplateRegistry([...BUILTIN_VIDEO_TEMPLATES, ...additional])
  }

  list(filter: TemplateFilter = {}): TemplateManifest[] {
    return this.registry.list(filter)
  }

  get(id: string, version?: string): TemplateManifest | undefined {
    return this.registry.get(id, version)
  }

  require(id: string, version?: string): TemplateManifest {
    return this.registry.require(id, version)
  }

  instantiate(input: InstantiateTemplateInput): TemplateInstantiation {
    return this.registry.instantiate(input)
  }
}
