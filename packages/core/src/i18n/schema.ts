import { z } from 'zod';
import { LANGUAGE_INPUTS, parseLanguage, parseLanguageSetting } from './language.ts';

const LANGUAGE_CODES = LANGUAGE_INPUTS.filter((l) => l !== 'auto');

/** A language code or alias (`zh-CN`, `zh-Hans`), in any letter case → `en`, `ko`, `ja`, or `zh`. */
export const LanguageSchema = z
  .string()
  .refine((v) => parseLanguage(v) !== undefined, {
    message: `expected one of ${LANGUAGE_CODES.join(', ')} (Traditional Chinese is not supported)`,
  })
  .transform((v) => parseLanguage(v)!)
  .meta({ enum: [...LANGUAGE_CODES] });

/** `auto` or a language (see LanguageSchema). */
export const LanguageSettingSchema = z
  .string()
  .refine((v) => parseLanguageSetting(v) !== undefined, {
    message: `expected one of ${LANGUAGE_INPUTS.join(', ')} (Traditional Chinese is not supported)`,
  })
  .transform((v) => parseLanguageSetting(v)!)
  .meta({ enum: [...LANGUAGE_INPUTS] });
