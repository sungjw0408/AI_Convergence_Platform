import { icon } from './icons.js';

export function bindSelectPickers(document) {
  const bindings = new WeakMap();
  let serial = 0, active;
  const close = (focus = false) => {
    if (!active) return;
    const current = active; active = undefined;
    current.menu.hidden = true; current.button.setAttribute('aria-expanded','false');
    if (focus && current.button.isConnected) current.button.focus();
  };
  function sync(binding) {
    const {select,button,menu} = binding;
    button.querySelector('span').textContent = select.options[select.selectedIndex]?.textContent || '선택해 주세요';
    button.disabled = select.matches(':disabled');
    button.classList.toggle('placeholder',!select.value);
    button.setAttribute('aria-required',String(select.required));
    menu.replaceChildren();
    [...select.options].forEach((option,index)=>{
      const row = document.createElement('li'); row.setAttribute('role','presentation');
      const choice = document.createElement('button'); choice.type='button'; choice.setAttribute('role','option');
      choice.textContent=option.textContent; choice.dataset.index=index;
      choice.disabled=option.disabled || option.parentElement.disabled === true;
      choice.setAttribute('aria-selected',String(index === select.selectedIndex));
      row.append(choice); menu.append(row);
    });
    if (button.disabled && active === binding) close();
  }
  function open(binding, focusOption = true) {
    close(); sync(binding); active=binding;
    const {button,menu,wrapper} = binding, rect=button.getBoundingClientRect();
    const below=(document.defaultView.innerHeight || 800)-rect.bottom-80;
    wrapper.dataset.placement=below<240 && rect.top>below ? 'above':'below';
    menu.hidden=false; button.setAttribute('aria-expanded','true');
    const selected=menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector('button:not(:disabled)');
    if (selected) { menu.scrollTop=Math.max(0,selected.offsetTop-menu.clientHeight/2); if(focusOption) selected.focus({preventScroll:true}); }
  }
  function enhance(select) {
    if (select.multiple || select.size>1 || bindings.has(select)) return;
    const label=select.closest('label');
    const title=select.getAttribute('aria-label') || (label ? [...label.childNodes].filter(node=>node!==select).map(node=>node.textContent).join(' ').trim() : '') || '항목 선택';
    const wrapper=document.createElement('span');wrapper.className='rento-select';
    const button=document.createElement('button');button.type='button';button.className='rento-select-trigger';
    button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-label',title);button.innerHTML='<span></span>'+icon('chevronDown');
    const menu=document.createElement('ul');menu.className='rento-select-menu';menu.id=`rento-select-${++serial}`;
    menu.setAttribute('role','listbox');menu.setAttribute('aria-label',title);menu.hidden=true;button.setAttribute('aria-controls',menu.id);
    select.before(wrapper);wrapper.append(select,button,menu);select.classList.add('rento-select-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const binding={select,wrapper,button,menu};bindings.set(select,binding);sync(binding);
    select.addEventListener('change',()=>{sync(binding);button.removeAttribute('aria-invalid');});
    select.addEventListener('invalid',event=>{event.preventDefault();button.setAttribute('aria-invalid','true');if(!active)open(binding);});
    button.addEventListener('click',event=>{event.preventDefault();active===binding ? close() : open(binding);});
    menu.addEventListener('click',event=>{
      const choice=event.target.closest('[data-index]');if(!choice || choice.disabled)return;
      event.preventDefault();select.selectedIndex=Number(choice.dataset.index);close(true);
      select.dispatchEvent(new document.defaultView.Event('input',{bubbles:true}));
      select.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));
    });
    wrapper.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close(true);return;}
      if(event.key==='Tab'){close();return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();if(active!==binding){open(binding);return;}
      const choices=[...menu.querySelectorAll('button:not(:disabled)')], index=choices.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?choices.length-1:Math.max(0,Math.min(choices.length-1,index+(event.key==='ArrowDown'?1:-1)));
      choices[next]?.focus();
    });
    select.form?.addEventListener('reset',()=>document.defaultView.setTimeout(()=>sync(binding),0));
  }
  const scan=node=>{if(node.nodeType!==1)return;if(node.matches('select'))enhance(node);node.querySelectorAll('select').forEach(enhance);};
  document.querySelectorAll('select').forEach(enhance);
  const observer=new document.defaultView.MutationObserver(records=>{
    for(const record of records){
      record.addedNodes.forEach(scan);
      const select=record.target.closest?.('select');if(select && bindings.has(select))sync(bindings.get(select));
      if(record.type==='attributes' && record.target.matches?.('fieldset')) record.target.querySelectorAll('select').forEach(s=>{if(bindings.has(s))sync(bindings.get(s));});
    }
    if(active && !active.button.isConnected)close();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','selected','required','label','value']});
  document.addEventListener('pointerdown',event=>{if(active && !active.wrapper.contains(event.target))close();});
  document.addEventListener('submit',()=>close(),true);
  return ()=>{observer.disconnect();close();};
}
