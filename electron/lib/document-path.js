const path = require('path');

function documentPathFromArgs(args) {
  const candidate = args.find((arg) =>
    typeof arg === 'string' && /\.(?:mdz|md)$/i.test(arg) && !arg.startsWith('--')
  );
  return candidate ? path.resolve(candidate) : null;
}

module.exports = { documentPathFromArgs };
