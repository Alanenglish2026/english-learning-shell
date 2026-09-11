export const AUDIO_VARIANTS=['clear_natural','natural_conversation','new_speaker'];
export class AudioProfile{
 constructor(asset={}){this.asset=asset;this.value={variant:asset.variant||'clear_natural',speaker_id:asset.speaker_id||asset.speaker||'legacy_temp',playback_rate:1,support_level:'independent',replay_count:0,text_visible:false,production_status:asset.production_status||asset.status||'TEMP',natural_retest_required:false};}
 condition(){return {...this.value};}
 support(kind,asset){if(kind==='replay'){this.value.replay_count++;if(this.value.support_level==='independent')this.value.support_level='replay';}
 else if(kind==='clear_support'){if(!asset||asset.variant!=='clear_natural')throw Error('本课还没有这段参考声音。');this.asset=asset;Object.assign(this.value,{variant:asset.variant,speaker_id:asset.speaker_id||asset.speaker||'unknown',support_level:kind});}
 else if(kind==='slow_support')Object.assign(this.value,{playback_rate:.85,support_level:kind});
 else if(kind==='text_support')Object.assign(this.value,{text_visible:true,support_level:kind});
 else throw Error('不支持的声音帮助。');this.value.natural_retest_required=true;return this.condition();}
 naturalRetest(asset=this.asset){if(!AUDIO_VARIANTS.includes(asset.variant||'clear_natural'))throw Error('音频配置无效。');this.asset=asset;Object.assign(this.value,{variant:asset.variant||'clear_natural',speaker_id:asset.speaker_id||asset.speaker||'legacy_temp',playback_rate:1,text_visible:false,support_level:'independent',replay_count:0,natural_retest_required:false});return this.condition();}
}
