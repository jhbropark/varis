(function(){
  function makeId(){return 'varis-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
  function init(){
    var form=document.getElementById('applyForm');
    if(!form)return;
    var leadField=form.querySelector('[name="lead_id"]');
    if(!leadField){leadField=document.createElement('input');leadField.type='hidden';leadField.name='lead_id';form.appendChild(leadField);}
    var qaField=form.querySelector('[name="qa"]');
    if(!qaField){qaField=document.createElement('input');qaField.type='hidden';qaField.name='qa';form.appendChild(qaField);}
    form.addEventListener('submit',function(){
      var leadId=makeId();
      var email=(form.querySelector('[name="이메일"]')||{}).value||'';
      var params=new URLSearchParams(location.search);
      var qa=params.get('qa')==='true'||/@example\.com$/i.test(email)||/(^|[+._-])(qa|test|debug)([+._-]|@)/i.test(email);
      leadField.value=leadId; qaField.value=qa?'true':'false'; window.__varisLastLeadId=leadId;
    },true);
    var base=window.varisTrack;
    if(typeof base==='function'&&!base.__leadWrapped){
      var wrapped=function(name,params){
        var next=Object.assign({},params||{});
        if(name==='generate_lead'){next.lead_id=window.__varisLastLeadId||next.lead_id||'';next.qa=next.qa||false;}
        return base(name,next);
      };
      wrapped.__leadWrapped=true; window.varisTrack=wrapped;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
