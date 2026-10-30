'use strict';
(() => {
  const bridge=window.deckWatch;
  if(!bridge)return;
  const $=id=>document.getElementById(id);
  // Only fixed, validated monitor operations are exposed; credentials stay in main.
  window.fetch=async(route,options={})=>{
    let result;
    if(route==='/api/status')result=await bridge.status();
    else if(route==='/api/pair')result=await bridge.pair({...JSON.parse(options.body),endpoint:$('macAddress').value});
    else if(route==='/api/settings')result=await bridge.interval(JSON.parse(options.body).pollSeconds);
    else throw new Error('Unsupported request');
    return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}});
  };
  bridge.config().then(config=>{$('macAddress').value=config.endpoint;$('macAddressSettings').value=config.endpoint;});
  $('changeMacForm').addEventListener('submit',async event=>{
    event.preventDefault();const t=window.deckUI.t;
    $('reconnectButton').disabled=true;$('connectionError').textContent=t('connecting');
    try{const result=await bridge.pair({endpoint:$('macAddressSettings').value,code:$('newPairCode').value});
      if(result.status!==200){$('connectionError').textContent=t(result.status===429?'rateError':result.status===503?'networkError':'pairError');return;}location.reload();
    }catch{$('connectionError').textContent=t('networkError');}
    finally{$('reconnectButton').disabled=false;}
  });
})();
