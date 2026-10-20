// Model actions for the Outputs view (lib/aid.mjs): the study characteristics drawn as a figure.
//
// The model only chooses among the views the field allows (lib/characteristic-visuals.mjs validates the choice); the values and the
// figure are computed here, and nothing changes until a person accepts.
import { durableAction } from '../lib/aid-proposals.mjs';
import { register, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { get, update } from '../store.mjs';
import { studies } from '../lib/screen.mjs';
import { chartableFields } from '../lib/charts.mjs';
import { detectCharacteristic, validateVisualSuggestion, renderCharacteristic, visualTitle, visualNote } from '../lib/characteristic-visuals.mjs';
import { esc } from '../lib/html.mjs';
import { figureTokens } from '../lib/figure-style.mjs';

const proposeVisual = durableAction('visualization', ({ fieldId, signature, proposal, model, prompt }) => {
  const now=get(),current=chartableFields(now,studies(now)).find(f=>f.id===fieldId);
  if(!current||detectCharacteristic(now,current,studies(now)).signature!==signature)return {refused:'The studies or reported values changed; request a fresh suggestion.'};
  update(s=>{s.characteristicViews||={};s.characteristicViews[fieldId]={...proposal,reviewed:true,model:model,prompt,at:new Date().toISOString()};return s;});
  return 'Visualization updated; source values unchanged';
});

register('outputs', [
  {
    id:'suggest-visualization',label:'Suggest a visualization',icon:'curve',task:'assist',brief:{record:false,criteria:false},
    when:s=>chartableFields(s,studies(s)).length>0,
    async run({state,cfg,signal,focus,context}) {
      const papers=studies(state),choices=chartableFields(state,papers),field=choices.find(f=>f.id===focus?.fieldId)||choices.find(f=>/design/i.test(f.label))||choices[0];
      if(!field)return {title:'Visualization',items:[],note:'No reported characteristic is available.'};
      const profile=detectCharacteristic(state,field,papers);
      const prompt=promptRef(P.overviewSuggestVisual);
      const categories=profile.groups.map(g=>({key:g.key,value:g.label,studies:g.ids.length}));
      if(categories.length>80||JSON.stringify(categories).length>16000)return {title:'Visualization',prompt,note:'This field exceeds the suggestion limit. Use its source table or ask chat about a smaller selection.',items:[]};
      const material=JSON.stringify({field:field.label,allowed:profile.choices,builtin:profile.mode,reason:profile.reason,studies:profile.total,parsedPairs:profile.pairs.length,numericValues:profile.numbers.length,categories});
      const out=await complete(cfg,P.messagesOf(P.overviewSuggestVisual,{material}),{prompt:P.overviewSuggestVisual,signal,json:true,temperature:0});
      const proposal=validateVisualSuggestion(profile,jsonOf(out));
      const groups=proposal.groups.map(g=>`<li><strong>${esc(g.label)}</strong>: ${g.values.map(esc).join('; ')}</li>`).join('');
      return {title:`Visualization · ${field.label}`,prompt,note:visualNote(profile,proposal),items:[{
        label:visualTitle(proposal.mode),detail:proposal.reason,
        preview:`<div class="chart-suggestion-preview chart-svg">${renderCharacteristic(profile,proposal,{width:500,max:10,style:figureTokens(null,{medium:'screen'}),title:`Included studies by ${field.label.split(' · ')[0].toLowerCase()}`})}${groups?`<ul>${groups}</ul>`:''}</div>`,
        acceptLabel:'Use this view',
        ...proposeVisual({ fieldId: field.id, signature: profile.signature, proposal, model: cfg.model, prompt }, context?.onVisualApplied),
      }]};
    },
  },
]);
