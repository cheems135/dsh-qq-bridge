// Windows may assign an ephemeral port that fetch refuses before networking.
// Only rebind that transport restriction, never retry an application failure.
export async function listenLocalServer(service){
 for(let attempt=0;attempt<8;attempt++){
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+service.server.address().port;
  try{const response=await fetch(base+'/config');await response.arrayBuffer();return base;}
  catch(error){if(error.cause?.message!=='bad port')throw error;await new Promise(resolve=>service.server.close(resolve));}
 }
 throw Error('No fetch-compatible test port allocated');
}
