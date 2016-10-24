#!/bin/bash

blochost=$fqdn

cd /var/run/strato/bloc-server
blocserver="/usr/lib/strato/bloc-server/bin/main.js"
sed -i "s|^apiURL: .*\$|apiURL: 'http://$blochost'|" config.yaml
HOST=0.0.0.0 exec $blocserver start
