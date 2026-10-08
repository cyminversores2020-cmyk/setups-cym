import readExcelFile from 'read-excel-file/node';
import { ImportError } from './signals.js';

/** Lee todas las pestañas de un .xlsx (Buffer) -> [{ sheet, data }]. */
export async function readWorkbook(buffer) {
  try {
    return await readExcelFile(buffer);
  } catch (e) {
    throw new ImportError(`No he podido abrir el archivo como Excel (.xlsx): ${e.message}`);
  }
}
