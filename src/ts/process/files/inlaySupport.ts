import { getDatabase } from "../../storage/database.svelte";
import { getModelInfo, LLMFlags } from "src/ts/model/modellist";

export function supportsInlayImage(){
    const db = getDatabase()
    return getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput)
}
