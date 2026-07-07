import { ipcMain } from 'electron'
import { translateText, type TranslateInput } from '../services/translator'

export function registerTranslateIpc(): void {
  ipcMain.handle('translate/text', async (_event, input: TranslateInput) => {
    return translateText(input)
  })
}
