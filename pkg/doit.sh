#!/bin/bash

stratoHost=${stratoHost:-$(curl ident.me)}
canonicalHost=$(getent hosts $stratoHost | tr -s ' ' | cut -d ' ' -f 2)
if [[ -z $canonicalHost || $canonicalHost == "localhost" ]]
then stratoHost="strato:3000"
fi

cd /var/run/strato/bloc-server
blocserver="/usr/lib/strato/bloc-server/bin/main.js"
sed -i "s|^apiURL: .*\$|apiURL: 'http$(${ssl:-false} && echo "s")://$stratoHost/strato-api'|" config.yaml
HOST=0.0.0.0 exec $blocserver start
